"use client";
import { useClientId } from "@/hooks/useClientId";
import { useGlobalStore } from "@/store/global";
import { Users } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "../ui/badge";
import { TooltipProvider } from "../ui/tooltip";
import { ConnectedUserItem } from "./ConnectedUserItem";

export const ConnectedUsersList = () => {
  const { clientId } = useClientId();
  const clients = useGlobalStore((state) => state.connectedClients);
  const currentUser = useGlobalStore((state) => state.currentUser);
  const isCurrentUserAdmin = currentUser?.isAdmin || currentUser?.isCreator || false;
  const setAdminStatus = useGlobalStore((state) => state.setAdminStatus);

  // Memoize client data to avoid unnecessary recalculations
  const clientsWithData = useMemo(() => {
    return clients.map((client) => {
      const isCurrentUser = client.clientId === clientId;
      return { client, isCurrentUser };
    });
  }, [clients, clientId]);

  return (
    <TooltipProvider>
      <div>
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h2 className="text-xs font-semibold tracking-wider text-neutral-400 flex items-center gap-1.5 uppercase">
            <Users className="h-3.5 w-3.5" />
            <span>Connected Users</span>
          </h2>
          <Badge variant="outline" className="border-white/10 bg-white/5 text-xs font-mono text-neutral-300">
            {clients.length}
          </Badge>
        </div>

        <div className="px-3 pb-3">
          {clients.length === 0 ? (
            <div className="text-center py-6 text-neutral-500 text-xs">No other users connected</div>
          ) : (
            <div className="space-y-1">
              <div className="relative">
                <div className="space-y-1 overflow-y-auto max-h-64 scrollbar-thin scrollbar-thumb-rounded-md scrollbar-thumb-muted-foreground/10 scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/20">
                  {clientsWithData.map(({ client }) => (
                    <ConnectedUserItem
                      key={client.clientId}
                      client={client}
                      isCurrentUser={client.clientId === currentUser?.clientId}
                      isAdmin={isCurrentUserAdmin}
                      onSetAdmin={setAdminStatus}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};
