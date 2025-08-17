import { LightningElement, api, track } from 'lwc';
import 's/forceLightTheme'; // Ensure light theme is applied

export default class MultilineHelptext extends LightningElement {
    @api content; // can contain \n or HTML (rendered safely by lightning-formatted-rich-text)
    @track visible = false;

    show() {
        this.visible = true;
    }
    hide() {
        this.visible = false;
    }
}
