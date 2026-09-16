// Three installations the sales team demonstrates with. Never in production.
List<Installation__c> demo = new List<Installation__c>{
    new Installation__c(External_Id__c = 'HEL-DEMO-001', Status__c = 'Planned'),
    new Installation__c(External_Id__c = 'HEL-DEMO-002', Status__c = 'Scheduled'),
    new Installation__c(External_Id__c = 'HEL-DEMO-003', Status__c = 'Completed')
};
upsert demo External_Id__c;
