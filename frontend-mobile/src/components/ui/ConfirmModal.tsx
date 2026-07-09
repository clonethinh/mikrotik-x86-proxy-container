import { Button, Modal } from '@heroui/react';

interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'primary';
  isPending?: boolean;
  onConfirm: () => void;
}

export default function ConfirmModal({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = 'Xác nhận',
  variant = 'danger',
  isPending,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header><Modal.Heading>{title}</Modal.Heading></Modal.Header>
            <Modal.Body><p className="text-sm text-muted">{message}</p></Modal.Body>
            <Modal.Footer>
              <Button variant="outline" onPress={() => onOpenChange(false)}>Huỷ</Button>
              <Button
                variant={variant === 'danger' ? 'danger' : 'primary'}
                isPending={isPending}
                onPress={() => { onConfirm(); onOpenChange(false); }}
              >
                {confirmLabel}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}