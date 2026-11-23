@AGENTS.md

# This fork

This checkout is Mark's fork. `origin` is upstream (pingdotgg/t3code) and `fork` is markhuot/t3code. Fork work lives on `feat/thread-spec` and is pushed to `fork`, never to `origin`. Keep fork-only instructions in this file, not in `AGENTS.md`, which upstream edits often.

## Merging upstream

1. `git fetch origin`, then `git merge origin/main` into `feat/thread-spec`. Merge, don't rebase: the branch is already pushed and other worktrees build from it.
2. Resolve conflicts by keeping both sides' intent. Compare each conflicted file against both parents (`git show MERGE_HEAD:<path>`, `git show HEAD:<path>`). Upstream often moves or refactors code the fork also touched; keep upstream's shape and re-add the fork's lines to it.
3. **Migrations.** Upstream owns the migration id sequence and the fork's migrations always sit on top. When upstream adds ids the fork already used:
   - As of the 2026-11-23 merge, upstream ends at 110 and the fork's migrations are 111 `ThreadSpecRevisions` and 112 `PipelineRuns`.
   - `git mv` the fork's files to the next ids after upstream's highest, and update `apps/server/src/persistence/Migrations.ts`, the expected manifest in `reconcileV2PreviewMigration.test.ts`, and any test that imports the files by path.
   - Never park fork migrations at a high offset such as 1000+. The Effect migrator skips every id below the highest recorded one, so later upstream migrations would never run.
   - Databases that already ran the fork's migrations at the old ids, like `~/.t3-spec` and dev `.t3` homes, are repaired at startup by `apps/server/src/persistence/reconcileForkMigrations.ts`. It drops ledger rows that carry a fork migration's name at the wrong id, and the migrator then reruns the migrations at their new ids. That only works because fork migrations are idempotent (`CREATE TABLE IF NOT EXISTS`; a migration that adds a column must check `pragma table_info` first). Add every new fork migration's name to `FORK_MIGRATION_NAMES`.
   - Prove it on a copy of the real database: `sqlite3 "file:$HOME/.t3-spec/userdata/statev2.sqlite?mode=ro" ".backup <scratch>/statev2.sqlite"`, run `runMigrations()` against the copy from `apps/server`, and check the ledger matches the manifest and fork data survived.
4. `apps/server/src/provider/agentContextBudget.json` holds measured byte counts. Set it to the values `AgentContextBudget.test.ts` reports after the merge.
5. Run `vp i` (upstream adds workspace packages), typecheck the packages with conflicts, and run the tests beside the conflicted files and `src/persistence`. The pre-commit hook runs fmt, lint and knip; knip rejects unused exports.

## Spec build and install

Mark runs the fork as "T3 Code (Spec)": bundle id `com.markhuot.t3code.spec`, data home `~/.t3-spec`. A headless launchd service, `com.markhuot.t3code.spec.service` (`~/Library/LaunchAgents`), runs the app's bundled server on `*:3774`, and the desktop app and the iPhone connect to it. Agents in this repo usually run inside that service.

- **Build worktree:** `/Users/markhuot/Sites/t3code-spec-build` stays detached at the commit being shipped, with three uncommitted patches that rename the build to Spec: `apps/desktop/src/app/DesktopUserData.ts`, `apps/mobile/app.config.ts` and `scripts/build-desktop-artifact.ts`. Never commit them. To move it, run `git stash`, `git fetch /Users/markhuot/Sites/t3code feat/thread-spec`, `git checkout --detach <sha>`, `git stash pop`, then `env -u T3CODE_HOME vp i`.
- **Desktop:** in the worktree, `env -u T3CODE_HOME T3CODE_DESKTOP_OUTPUT_DIR=/private/tmp/spec-out node scripts/build-desktop-artifact.ts --platform mac --target dir --arch arm64`. Then edit the built app's Info.plist: delete `CFBundleURLTypes`, and set `LSEnvironment` `T3CODE_HOME=/Users/markhuot/.t3-spec` and `T3CODE_DISABLE_AUTO_UPDATE=1`. Delete `Contents/Resources/app-update.yml`, run `xattr -cr`, and re-sign with `codesign --force --deep --sign -`.
- **iOS:** when native dependencies or `app.config.ts` change, run `env -u T3CODE_HOME APP_VARIANT=production npx expo prebuild --platform ios --clean --no-install` and `pod install` in `apps/mobile`. Then build with `xcodebuild -workspace T3CodeSpec.xcworkspace -scheme T3CodeSpec -configuration Release -destination id=<phone UDID> -allowProvisioningUpdates DEVELOPMENT_TEAM=47P4ZSALX4`, and install with `xcrun devicectl device install app --device <UDID> <T3CodeSpec.app>`. Get the UDID from `xcrun devicectl list devices`.
- **Swap and restart:** `scripts/spec-swap.sh "/private/tmp/spec-out/mac-arm64/T3 Code (Spec).app"` does the swap. It quits the app, boots out the service, `trash`es the old app and `ditto`s the new one into `/Applications`, then re-bootstraps the service. It retries the bootstrap because one sent right after a bootout fails with `Bootstrap failed: 5: Input/output error`. Finally it waits for `:3774` to answer and reopens the app. It logs to `$SPEC_SWAP_REPORT`.
  - Restarting the service kills any agent running inside it, so never run the script directly from such a session. Load a one-shot launchd job instead: write a plist with label `com.markhuot.t3code.spec.swap`, `RunAtLoad`, `AbandonProcessGroup`, your `PATH` and `HOME`, and a log path in your scratchpad, then load it with `launchctl bootstrap gui/$(id -u) <plist>`.
  - The job runs a wrapper that sleeps about 45 seconds, so your last reply goes out first. The wrapper then starts `claude -p "<brief>" --model sonnet --allowedTools "Bash Read Write Edit"`, which runs the script, fixes failures, monitors the service for 10 minutes, writes a report, and finishes with `launchctl remove com.markhuot.t3code.spec.swap`.
  - The brief must tell the supervisor:
    - Never leave the service down; as a last resort, restore the old app from `~/.Trash`.
    - Health means `/.well-known/t3/environment` reports the new `serverVersion` and `databaseMigration`, the pid stays the same, the service listens on `*:3774`, and the migration ledger matches the manifest.
  - Mark approved this detached job as the exception to AGENTS.md's no-detach rule, and only for this swap. Remove the job when it finishes.
- Disk space is tight. Delete `/private/tmp/spec-out` and the iOS `build/DerivedData` intermediates when done.
