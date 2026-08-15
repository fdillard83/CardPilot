export type AccountPreferences = {
  autoValueEnabled: boolean;
  autoValueMaxCents: number | null;
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
  ebaySellingDefaults: {
    merchantLocationKey: "",
    fulfillmentPolicyId: "",
    paymentPolicyId: "",
    returnPolicyId: "",
  },
};
