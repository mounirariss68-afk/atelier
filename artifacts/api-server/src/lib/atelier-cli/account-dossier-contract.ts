export type AccountDossierContractResult<TWorkspace> =
  | { kind: "invalid_input" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "ok"; workspace: TWorkspace };

export async function executeAccountDossierRead<TAccess, TWorkspace>(args: {
  accountId: string;
  loadAccess: () => Promise<TAccess>;
  canSee: (access: TAccess, accountId: string) => Promise<boolean>;
  loadWorkspace: (access: TAccess, accountId: string) => Promise<TWorkspace | null>;
}): Promise<AccountDossierContractResult<TWorkspace>> {
  const accountId = args.accountId.trim();
  if (!accountId) return { kind: "invalid_input" };
  const access = await args.loadAccess();
  if (!(await args.canSee(access, accountId))) return { kind: "forbidden" };
  const workspace = await args.loadWorkspace(access, accountId);
  return workspace === null ? { kind: "not_found" } : { kind: "ok", workspace };
}