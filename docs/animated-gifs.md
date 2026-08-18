# Animated GIFs of the documentation

The static screenshots of the documentation are regenerated automatically
(`yarn screenshots`, see [CONTRIBUTING](../CONTRIBUTING.md#regenerating-the-documentation-screenshots)).

**The animated GIFs are recorded by hand**, because they tell a story: they
follow a real workflow, at a human pace, with a real org. This page lists the
ones that still show the **pre-v8 design** and must be re-recorded, what each
one has to show, and where it is displayed.

All of them live in the sibling repository, under
`sfdx-hardis/docs/assets/images/`, and are referenced from both documentations.

## Recording conventions

- **Light theme, English UI**, like every other screenshot of the documentation.
- Real project, no confidential data: no customer name, no real org URL, no
  token, no e-mail address of a real user.
- 1920x1080 source, no cursor trail, no notification toast.
- Keep them **short and small**: aim for under 30 seconds and a few MB. Several
  current files are 10 to 30 MB, which is far too heavy for a documentation
  page.
- The optional helper below can produce the raw frames of a scenario if you
  prefer to assemble the GIF yourself.

<details markdown="1">
<summary>Optional: capturing raw frames with the screenshot harness</summary>

`yarn screenshots` can also record a scenario as a sequence of PNG frames, in
`doc-screenshots/recordings/<name>/`. The scenarios live in
`src/test/ui/docScreenshots.test.ts` (search for `record(`), and the mocked CLI
plays the matching command in `test/fixtures/sf-shim/sf-mock.js`
(`DOCS_SCENARIOS`). They are a starting point for a manual recording, not a
replacement for it.

</details>

## To re-record (extension UI, still in the previous design)

| GIF                                        | What it must show                                                                                               | Used by                                                                                                                                 |
|--------------------------------------------|-----------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `extension-demo.gif`                       | Overall tour of the extension: Welcome page, then a couple of workbenches opened from it                        | sfdx-hardis `index.md`, `vscode-extension.md`, `README.md` + extension `README.md`                                                      |
| `sfdx-hardis-pipeline-view.gif`            | DevOps Pipeline panel: branch/org diagram, open pull requests tab, contribution shortcuts                       | sfdx-hardis `index.md`, `salesforce-ci-cd-home.md`, `README.md` + extension `README.md`                                                 |
| `orgs-manager.gif`                         | Orgs Manager: list of orgs, "View all orgs" toggle, row actions menu, connecting to an org                      | sfdx-hardis `vscode-extension.md` + extension `README.md`                                                                               |
| `metadata-retriever.gif`                   | Metadata Retriever: filters, search, selection of several items, retrieve                                       | sfdx-hardis `salesforce-ci-cd-publish-task.md`, `vscode-extension.md` + extension `README.md`                                           |
| `monitoring-config-2026.gif`               | Monitoring Config Workbench: browsing the categories, changing a frequency and a notification threshold, saving | sfdx-hardis `salesforce-ci-cd-home.md`, `salesforce-monitoring-config-home.md`, `salesforce-monitoring-home.md` + extension `README.md` |
| `project-documentation.gif`                | Documentation Workbench: generation options, Generate Documentation, then the generated site                    | extension `README.md`                                                                                                                   |
| `new-user-story-2026.gif`                  | `New User Story`: the questions of `hardis:work:new` answered in the command panel, up to the created branch    | sfdx-hardis `hardis/work/new.md`, `salesforce-ci-cd-create-new-task.md`, `src/commands/hardis/work/new.ts` + extension `README.md`      |
| `retrieve-and-commit-2026.gif`             | Pull from org then commit: retrieved metadata, staging in Source Control, cleanings applied                     | sfdx-hardis `hardis/work/save.md`, `salesforce-ci-cd-publish-task.md`, `src/commands/hardis/work/save.ts` + extension `README.md`       |
| `save-publish-pr-2026.gif`                 | `Save / Publish User Story` up to the created pull request, with the actions bar at the end of the run          | sfdx-hardis `hardis/work/save.md`, `salesforce-ci-cd-publish-task.md`, `src/commands/hardis/work/save.ts` + extension `README.md`       |
| `animation-install-packages.gif`           | Installing a package from the menu, and its registration in `.sfdx-hardis.yml`                                  | sfdx-hardis `salesforce-ci-cd-work-on-task-install-packages.md`                                                                         |
| `activate-merge-driver-in-sfdx-hardis.gif` | Activating the Salesforce git merge driver from the extension                                                   | sfdx-hardis `salesforce-ci-cd-hotfixes.md`                                                                                              |
| `multi-org-query-demo.gif`                 | Multi-org SOQL Query & Report: selecting the orgs, the query, and the generated report                          | sfdx-hardis `hardis/org/multi-org-query.md`, `src/commands/hardis/org/multi-org-query.ts`                                               |
| `sfdx-hardis-plugin-demo.gif`              | The extension as the graphical companion of the plugin: menu, then a command running                            | sfdx-hardis `sfdx-hardis-plugins.md`                                                                                                    |
| `detect-inactive-metadata.gif`             | Running the inactive metadata detection and reading its report (VS Code, currently in dark theme)               | sfdx-hardis `hardis/lint/metadatastatus.md`, `salesforce-monitoring-inactive-metadata.md`, `src/commands/hardis/lint/metadatastatus.ts` |

## Nothing to do

These animations do not show the extension UI, so the redesign does not affect
them: `AI-Assistant.gif` (pull request page of the git provider) and
`screenshot-project-doc-profile.gif` (generated documentation site).
