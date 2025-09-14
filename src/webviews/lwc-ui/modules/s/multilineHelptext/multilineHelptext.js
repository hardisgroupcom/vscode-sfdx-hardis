import { LightningElement, api, track } from "lwc";
import "s/forceLightTheme"; // Ensure light theme is applied

export default class MultilineHelptext extends LightningElement {
  @api content; // can contain \n or HTML (rendered safely by lightning-formatted-rich-text)
  @track visible = false;
  @track positionLeft = false;
  @track positionTop = false;

  show() {
    this.visible = true;
    // Calculate positioning after the element becomes visible
    requestAnimationFrame(() => {
      this.calculatePosition();
    });
  }

  hide() {
    this.visible = false;
    this.positionLeft = false;
    this.positionTop = false;
  }

  calculatePosition() {
    const popover = this.template.querySelector(".multiline-helptext-popover");
    const wrapper = this.template.querySelector(".helptext-wrapper");

    if (!popover || !wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popoverWidth = 420; // max-width from CSS
    const popoverHeight = 150; // estimated height

    // Check horizontal positioning
    const spaceOnRight = viewportWidth - wrapperRect.right;

    // If not enough space on right (less than popover width + margin), position on left
    if (spaceOnRight < popoverWidth + 20) {
      this.positionLeft = true;
    } else {
      this.positionLeft = false;
    }

    // Check vertical positioning
    const spaceBelow = viewportHeight - wrapperRect.bottom;

    // If not enough space below (less than popover height + margin), position on top
    if (spaceBelow < popoverHeight + 20) {
      this.positionTop = true;
    } else {
      this.positionTop = false;
    }
  }

  get popoverClass() {
    const horizontalClass = this.positionLeft
      ? "position-left"
      : "position-right";
    const verticalClass = this.positionTop ? "position-top" : "position-bottom";
    return `slds-popover slds-popover_tooltip multiline-helptext-popover ${horizontalClass} ${verticalClass}`;
  }
}
