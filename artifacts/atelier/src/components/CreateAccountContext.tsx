/**
 * Task #560 — app-level controller for the CreateAccountDialog.
 *
 * The chat `account_proposal` card lives deep in the transcript and cannot
 * own the heavyweight dialog itself. Instead it calls `openWithPrefill(draft)`
 * from this context, which mounts a single controlled dialog at the app root
 * and hydrates it with the Cartographer draft.
 */
import * as React from "react";
import {
  CreateAccountDialog,
  type AccountPrefill,
} from "./CreateAccountDialog";

interface CreateAccountContextValue {
  openWithPrefill: (data: AccountPrefill) => void;
}

const CreateAccountContext = React.createContext<CreateAccountContextValue>({
  openWithPrefill: () => {},
});

export function useCreateAccount(): CreateAccountContextValue {
  return React.useContext(CreateAccountContext);
}

export function CreateAccountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<AccountPrefill | null>(null);

  const openWithPrefill = React.useCallback((data: AccountPrefill) => {
    setPrefill(data);
    setOpen(true);
  }, []);

  const value = React.useMemo(() => ({ openWithPrefill }), [openWithPrefill]);

  return (
    <CreateAccountContext.Provider value={value}>
      {children}
      <CreateAccountDialog
        open={open}
        onOpenChange={setOpen}
        initialData={prefill}
      />
    </CreateAccountContext.Provider>
  );
}
