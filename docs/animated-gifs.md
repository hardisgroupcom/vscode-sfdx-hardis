# Animated GIFs of the documentation

The static screenshots of the documentation are regenerated automatically
(`yarn screenshots`, see [CONTRIBUTING](../CONTRIBUTING.md#regenerating-the-documentation-screenshots)).

Most animated GIFs are now assembled automatically too: `yarn screenshots`
records the scripted scenarios of `src/test/ui/docScreenshots.test.ts` as
frame sequences (`doc-screenshots/recordings/<name>/`), and
`python scripts/build-doc-images.py` turns them into optimized GIFs (one
shared palette, identical consecutive frames merged) directly in
`sfdx-hardis/docs/assets/images/`.

All of them live in the sibling repository, under
`sfdx-hardis/docs/assets/images/`, and are referenced from both documentations.

## Assembled automatically from the harness recordings

| GIF                             | Recording                 | What it shows                                                                                                    |
|---------------------------------|---------------------------|------------------------------------------------------------------------------------------------------------------|
| `sfdx-hardis-pipeline-view.gif` | `devops-pipeline`         | DevOps Pipeline panel: branch/org diagram with feature branches and running jobs, open pull requests tab          |
| `orgs-manager.gif`              | `orgs-manager`            | Orgs Manager: list of orgs, "View all orgs" toggle, row actions menu                                              |
| `metadata-retriever.gif`        | `metadata-retriever`      | Metadata Retriever: search, selection of several items                                                            |
| `monitoring-config-2026.gif`    | `monitoring-config`       | Monitoring Config Workbench: browsing the categories, frequency picker                                            |
| `project-documentation.gif`     | `documentation-workbench` | Documentation Workbench: generation options and deployment cards                                                  |
| `new-user-story-2026.gif`       | `work-new`                | `New User Story`: the questions of `hardis:work:new` answered in the command panel, up to the created branch      |
| `save-publish-pr-2026.gif`      | `work-save`               | `Save / Publish User Story` (`hardis:work:save`): delta package.xml, cleanings, push, with the actions bar at the end of the run |
| `animation-install-packages.gif` | `install-packages`       | Manage Packages from the DevOps Pipeline, Install new package (`hardis:package:install`), then the new package in the workbench |

## Recording conventions (manual GIFs)

- **Light theme, English UI**, like every other screenshot of the documentation.
- Real project, no confidential data: no customer name, no real org URL, no
  token, no e-mail address of a real user.
- 1920x1080 source, no cursor trail, no notification toast.
- Keep them **short and small**: aim for under 30 seconds and a few MB.

## Still recorded by hand (no harness scenario yet)

| GIF                                        | What it must show                                                                                 | Used by                                                                                                                                 |
|--------------------------------------------|-----------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `retrieve-and-commit-2026.gif`             | Pull from org then commit: retrieved metadata, staging in Source Control                          | sfdx-hardis `hardis/work/save.md`, `salesforce-ci-cd-publish-task.md` + extension `README.md`                                           |
| `activate-merge-driver-in-sfdx-hardis.gif` | Activating the Salesforce git merge driver from the extension                                     | sfdx-hardis `salesforce-ci-cd-hotfixes.md`                                                                                              |
| `multi-org-query-demo.gif`                 | Multi-org SOQL Query & Report: selecting the orgs, the query, and the generated report            | sfdx-hardis `hardis/org/multi-org-query.md`, `src/commands/hardis/org/multi-org-query.ts`                                               |
| `sfdx-hardis-plugin-demo.gif`              | The extension as the graphical companion of the plugin: menu, then a command running              | sfdx-hardis `sfdx-hardis-plugins.md`                                                                                                    |
| `detect-inactive-metadata.gif`             | Running the inactive metadata detection and reading its report (VS Code, currently in dark theme) | sfdx-hardis `hardis/lint/metadatastatus.md`, `salesforce-monitoring-inactive-metadata.md`, `src/commands/hardis/lint/metadatastatus.ts` |

## Nothing to do

These animations do not show the extension UI, so the redesign does not affect
them: `AI-Assistant.gif` (pull request page of the git provider) and
`screenshot-project-doc-profile.gif` (generated documentation site).
