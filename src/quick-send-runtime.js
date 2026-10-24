import { QuickSend } from "./quick-send.js";
import { proposalPreparation } from "./docfill/proposal-runtime.js";
import { quoteDelivery } from "./docfill/delivery-runtime.js";
import { sp } from "./sharepoint-runtime.js";
export const quickSend=new QuickSend({prepare:proposalPreparation,delivery:quoteDelivery,sp});
