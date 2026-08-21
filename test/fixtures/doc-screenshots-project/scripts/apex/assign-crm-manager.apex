// Assign the CRM_Manager permission set to every active System Administrator
PermissionSet crmManager = [SELECT Id FROM PermissionSet WHERE Name = 'CRM_Manager' LIMIT 1];
List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
for (User adminUser : [SELECT Id FROM User WHERE Profile.Name = 'System Administrator' AND IsActive = true]) {
  assignments.add(new PermissionSetAssignment(AssigneeId = adminUser.Id, PermissionSetId = crmManager.Id));
}
Database.insert(assignments, false);
