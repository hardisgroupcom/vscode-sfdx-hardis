public with sharing class CaseTriageService {
    public static final String DEFAULT_QUEUE = 'Support_Level_1';

    @InvocableMethod(label='Find the queue of a case' description='Used by the Case Triage agent')
    public static List<String> findQueues(List<Case> records) {
        List<String> queues = new List<String>();
        for (Case record : records) {
            queues.add(findQueue(record));
        }
        return queues;
    }

    public static String findQueue(Case record) {
        if (record.Priority == 'High') {
            return 'Support_Escalations';
        }
        if (record.Triage_Category__c != null) {
            return 'Support_' + record.Triage_Category__c;
        }
        return DEFAULT_QUEUE;
    }
}
