// Initialize the new Segment__c field of the existing accounts from their industry
List<Account> accounts = [SELECT Id, Industry, Segment__c FROM Account WHERE Segment__c = null LIMIT 10000];
for (Account account : accounts) {
  account.Segment__c = account.Industry == 'Technology' ? 'Enterprise' : 'Mid-Market';
}
update accounts;
