/** In-memory navigation signal only. Draft contents remain in each form's scoped storage. */
const dirtyScopes = new Set<string>();
export function setWorkspaceDraftDirty(scope: string, dirty: boolean) {
  if (dirty) dirtyScopes.add(scope);
  else dirtyScopes.delete(scope);
}
export function workspaceHasUnsavedChanges() {
  return dirtyScopes.size > 0;
}
