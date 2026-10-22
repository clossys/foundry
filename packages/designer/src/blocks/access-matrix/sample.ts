import type { AccessMatrixProps } from "../AccessMatrix.js";

export const accessMatrixSample: AccessMatrixProps = {
  "aria-label": "Workspace access",
  roles: [{ id: "viewer", label: "Viewer" }, { id: "editor", label: "Editor" }, { id: "admin", label: "Admin", isLocked: true, lockedReason: "Admin always has every permission." }],
  groups: [
    { id: "projects", label: "Projects", permissions: [{ id: "view-projects", label: "View projects" }, { id: "create-projects", label: "Create projects" }, { id: "delete-projects", label: "Delete projects", description: "Removes the project and its files." }] },
    { id: "reports", label: "Reports", permissions: [{ id: "view-reports", label: "View reports" }, { id: "export-reports", label: "Export reports" }] },
    { id: "members", label: "Members", permissions: [{ id: "invite-members", label: "Invite members" }, { id: "remove-members", label: "Remove members" }] },
  ],
  value: {
    viewer: { "view-projects": { state: "granted" }, "view-reports": { state: "granted" } },
    editor: { "view-projects": { state: "granted" }, "create-projects": { state: "granted" }, "delete-projects": { state: "granted" }, "export-reports": { state: "inherited", reason: "Included with Viewer access to reports." } },
    admin: { "view-projects": { state: "granted" }, "create-projects": { state: "granted" }, "delete-projects": { state: "granted" }, "view-reports": { state: "granted" }, "export-reports": { state: "granted" }, "invite-members": { state: "granted" }, "remove-members": { state: "granted" } },
  },
  labels: {
    permissionHeader: "Permission", cell: (role, permission) => `${role}: ${permission}`, groupAll: (role, group) => `${role}: all of ${group}`,
    inherited: "Inherited", locked: "Locked", changeSummary: (grants, revokes) => `${grants} added, ${revokes} removed`,
  },
};
accessMatrixSample.baseline = { ...accessMatrixSample.value, editor: { ...accessMatrixSample.value.editor, "delete-projects": { state: "denied" } } };
