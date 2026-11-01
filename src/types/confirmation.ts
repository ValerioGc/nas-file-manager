export type ConfirmationRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
};

export type ConfirmationResolver = (request: ConfirmationRequest) => Promise<boolean>;
