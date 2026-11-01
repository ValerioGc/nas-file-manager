export type FileAction = 'copy' | 'delete' | 'download' | 'move' | 'rename' | 'hide' | 'show';

export type ContextAction =
  | FileAction
  | 'copy-to-clipboard'
  | 'cut-to-clipboard'
  | 'favorite'
  | 'paste'
  | 'share'
  | 'open-drive'
  | 'shortcut';

/** An entry of the context menu, hidden when it does not apply to the selection. */
export interface MenuAction {
  type: ContextAction;
  label: string;
  icon: string;
  visible: boolean;
}

export type PreviewAction = FileAction | 'favorite';
