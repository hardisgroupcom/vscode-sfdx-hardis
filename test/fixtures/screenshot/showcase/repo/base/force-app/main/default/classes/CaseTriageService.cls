public with sharing class CaseTriageService {
    public static final String DEFAULT_QUEUE = 'Support_Level_1';

    public static String findQueue(Case record) {
        if (record.Priority == 'High') {
            return 'Support_Escalations';
        }
        return DEFAULT_QUEUE;
    }
}
