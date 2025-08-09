import * as vscode from "vscode";
import { LwcUiPanel } from "./webviews/lwc-ui-panel";

/**
 * Manager for LWC UI panels
 * Handles creation, disposal, and lifecycle of LWC panels
 */
export class LwcPanelManager {
  private static instance: LwcPanelManager | null = null;
  private activePanels: Map<string, LwcUiPanel> = new Map();
  private panelDisposeTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  private disposalCallbacks: Map<string, () => void> = new Map();
  private context: vscode.ExtensionContext;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Get or create the singleton instance of LwcPanelManager
   */
  public static getInstance(
    context?: vscode.ExtensionContext,
  ): LwcPanelManager {
    if (!LwcPanelManager.instance) {
      if (!context) {
        throw new Error(
          "Context required for first initialization of LwcPanelManager",
        );
      }
      LwcPanelManager.instance = new LwcPanelManager(context);
    }
    return LwcPanelManager.instance;
  }

  /**
   * Create or get an existing LWC panel for the specified component
   * @param lwcId The LWC component identifier
   * @param initData Optional initialization data
   * @returns The LWC panel instance
   */
  public getOrCreatePanel(lwcId: string, initData?: any): LwcUiPanel {
    // Clear any existing dispose timer for this panel
    this.clearDisposeTimer(lwcId);

    // Check if panel already exists and is not disposed
    const existingPanel = this.activePanels.get(lwcId);
    if (existingPanel && !existingPanel.isDisposed()) {
      // Panel exists, reveal it and update with new data if provided
      const column = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;
      existingPanel.reveal(column);

      if (initData) {
        existingPanel.sendInitializationData(initData);
      }
      return existingPanel;
    }

    // Create new panel
    const panel = LwcUiPanel.display(
      this.context.extensionUri,
      lwcId,
      initData,
    );

    // Store reference to the panel
    this.activePanels.set(lwcId, panel);

    // Set up disposal handling
    const originalDispose = panel.dispose.bind(panel);
    panel.dispose = () => {
      // Call disposal callback if registered
      const callback = this.disposalCallbacks.get(lwcId);
      if (callback) {
        try {
          callback();
        } catch (error) {
          console.error("Error in disposal callback:", error);
        }
        this.disposalCallbacks.delete(lwcId);
      }

      // Clean up our references when panel is disposed
      this.activePanels.delete(lwcId);
      this.clearDisposeTimer(lwcId);
      // Call original dispose
      originalDispose();
    };

    return panel;
  }

  /**
   * Get an existing panel by LWC ID
   * @param lwcId The LWC component identifier
   * @returns The panel instance or null if not found
   */
  public getPanel(lwcId: string): LwcUiPanel | null {
    const panel = this.activePanels.get(lwcId);
    return panel && !panel.isDisposed() ? panel : null;
  }

  /**
   * Schedule a panel for disposal after a delay
   * @param lwcId The LWC component identifier
   * @param delayMs Delay in milliseconds before disposal (default: 2000ms)
   */
  public scheduleDisposal(lwcId: string, delayMs: number = 2000): void {
    // Clear any existing timer
    this.clearDisposeTimer(lwcId);

    // Set new timer
    const timer = setTimeout(() => {
      const panel = this.activePanels.get(lwcId);
      if (panel && !panel.isDisposed()) {
        panel.dispose();
      }
      this.panelDisposeTimers.delete(lwcId);
    }, delayMs);

    this.panelDisposeTimers.set(lwcId, timer);
  }

  /**
   * Set a disposal callback for a specific panel
   * @param lwcId The LWC component identifier
   * @param callback Function to call when the panel is disposed
   */
  public setDisposalCallback(lwcId: string, callback: () => void): void {
    this.disposalCallbacks.set(lwcId, callback);
  }

  /**
   * Clear the dispose timer for a specific panel
   * @param lwcId The LWC component identifier
   */
  public clearDisposeTimer(lwcId: string): void {
    const timer = this.panelDisposeTimers.get(lwcId);
    if (timer) {
      clearTimeout(timer);
      this.panelDisposeTimers.delete(lwcId);
    }
  }

  /**
   * Dispose a specific panel immediately
   * @param lwcId The LWC component identifier
   */
  public disposePanel(lwcId: string): void {
    this.clearDisposeTimer(lwcId);
    this.disposalCallbacks.delete(lwcId);
    const panel = this.activePanels.get(lwcId);
    if (panel && !panel.isDisposed()) {
      panel.dispose();
    }
  }

  /**
   * Dispose all active panels
   */
  public disposeAllPanels(): void {
    // Clear all timers
    this.panelDisposeTimers.forEach((timer) => clearTimeout(timer));
    this.panelDisposeTimers.clear();

    // Clear all disposal callbacks
    this.disposalCallbacks.clear();

    // Dispose all panels
    this.activePanels.forEach((panel) => {
      if (!panel.isDisposed()) {
        panel.dispose();
      }
    });
    this.activePanels.clear();
  }

  /**
   * Get the number of active panels
   */
  public getActivePanelCount(): number {
    // Filter out disposed panels
    let count = 0;
    this.activePanels.forEach((panel) => {
      if (!panel.isDisposed()) {
        count++;
      }
    });
    return count;
  }

  /**
   * Get all active panel LWC IDs
   */
  public getActivePanelIds(): string[] {
    const activeIds: string[] = [];
    this.activePanels.forEach((panel, lwcId) => {
      if (!panel.isDisposed()) {
        activeIds.push(lwcId);
      }
    });
    return activeIds;
  }

  /**
   * Clean up the manager instance
   */
  public dispose(): void {
    this.disposeAllPanels();
    LwcPanelManager.instance = null;
  }
}
