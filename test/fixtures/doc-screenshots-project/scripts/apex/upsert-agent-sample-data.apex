// Upsert the sample accounts and cases used to test the Agentforce agents
List<Account> sampleAccounts = new List<Account>{
  new Account(Name = 'Agent Sample - Retail', External_Id__c = 'AGENT_SAMPLE_RETAIL', Industry = 'Retail'),
  new Account(Name = 'Agent Sample - Energy', External_Id__c = 'AGENT_SAMPLE_ENERGY', Industry = 'Energy')
};
upsert sampleAccounts External_Id__c;
List<Case> sampleCases = new List<Case>();
for (Account sampleAccount : sampleAccounts) {
  sampleCases.add(new Case(AccountId = sampleAccount.Id, Subject = 'Agent sample case', Origin = 'Web', Status = 'New'));
}
Database.insert(sampleCases, false);
