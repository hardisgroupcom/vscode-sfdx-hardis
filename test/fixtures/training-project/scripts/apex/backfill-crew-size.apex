// Gives every installation without a crew the default crew of two, so that
// Crew_Size__c can be made mandatory in the next deployment.
List<Installation__c> toFix = [SELECT Id FROM Installation__c WHERE Crew_Size__c = null LIMIT 10000];
for (Installation__c installation : toFix) {
    installation.Crew_Size__c = 2;
}
update toFix;
System.debug('Backfilled ' + toFix.size() + ' installations');
