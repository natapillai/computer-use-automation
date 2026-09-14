// Role sets shared by matching, label derivation and snapshot translation.

// Roles a label can name. A cell reading Member ID: is text, not a labelled control.
export const LABELLED_ROLES: ReadonlySet<string> = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'checkbox',
  'radio',
  'spinbutton',
  'slider',
  'switch',
]);

// Roles a person operates. A pointer cursor on anything else is only a hint.
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  ...LABELLED_ROLES,
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'treeitem',
  'iframe',
]);

// Roles whose text is what a person typed or picked, so it is a value and not a name.
export const VALUE_ROLES: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
