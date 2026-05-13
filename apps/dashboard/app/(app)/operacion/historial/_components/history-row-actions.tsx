'use client';

import * as React from 'react';
import { Button } from '@faka/ui';
import { ReprocessModal } from './reprocess-modal';

export interface HistoryRowActionsProps {
  uploadId: string;
  canal: string;
  tipo: string;
  currentProfileId: string | null;
  currentProfileVersion: number | null;
  availableProfiles: Array<{ id: string; nombre: string; version: number; is_active: boolean }>;
  status: string;
}

export function HistoryRowActions(props: HistoryRowActionsProps) {
  const [open, setOpen] = React.useState(false);
  const canReprocess = props.status !== 'validating';

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!canReprocess}
      >
        Reprocesar
      </Button>
      <ReprocessModal
        open={open}
        onClose={() => setOpen(false)}
        uploadId={props.uploadId}
        canal={props.canal}
        tipo={props.tipo}
        currentProfileId={props.currentProfileId}
        currentProfileVersion={props.currentProfileVersion}
        availableProfiles={props.availableProfiles}
      />
    </>
  );
}
