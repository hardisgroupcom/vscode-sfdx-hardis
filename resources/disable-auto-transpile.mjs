// Preloaded via NODE_OPTIONS --import into the sf CLI processes started by the
// extension when the sfdx-hardis plugin is linked (sf plugins link).
// oclif always auto-transpiles a linked plugin from its TypeScript sources at
// every command (several seconds per run, and the transpilation starves the
// event loop, delaying the WebSocket exchanges with this extension). Setting
// this flag makes oclif load the plugin's compiled lib folder instead, like an
// installed plugin - the sfdx-hardis contribution flow keeps lib fresh with
// `tsc --watch`. See the "linkedSfdxHardisAutoTranspile" extension setting.
globalThis.oclif = { enableAutoTranspile: false };
