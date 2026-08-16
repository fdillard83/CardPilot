export type AccountPreferences = {
  autoValueEnabled: boolean;
  autoValueMaxCents: number | null;
  ebayConnectPromptDismissed: boolean;
  ebaySellingDefaults: {
    merchantLocationKey: string;
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
  };
};

export const defaultAccountPreferences: AccountPreferences = {
  autoValueEnabled: false,
  autoValueMaxCents: null,
  ebayConnectPromptDismissed: false,
  ebaySellingDefaults: {
    merchantLocationKey: "",
    fulfillmentPolicyId: "",
    paymentPolicyId: "",
    returnPolicyId: "",
  },
};
