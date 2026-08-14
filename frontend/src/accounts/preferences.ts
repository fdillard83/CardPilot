export type AccountPreferences = {
  autoValueEnabled: boolean;
  autoValueMaxCents: number | null;
};

export const defaultAccountPreferences: AccountPreferences = {
  autoValueEnabled: false,
  autoValueMaxCents: null,
};
