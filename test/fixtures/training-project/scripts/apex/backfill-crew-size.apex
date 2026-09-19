// Starts the backfill as a batch: the script returns at once, and Salesforce
// works through the installations without a crew size, 200 at a time.
Id jobId = Database.executeBatch(new CrewSizeBackfillBatch(), 200);
System.debug('Crew size backfill started, batch job ' + jobId);
