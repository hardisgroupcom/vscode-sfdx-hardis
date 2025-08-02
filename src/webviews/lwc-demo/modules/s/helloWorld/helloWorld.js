import { LightningElement, track } from 'lwc';

export default class HelloWorld extends LightningElement {
    @track greeting = 'Hello World from SFDX Hardis!';
    @track counter = 0;

    handleIncrement() {
        this.counter++;
    }

    handleDecrement() {
        this.counter--;
    }

    handleReset() {
        this.counter = 0;
    }
}
