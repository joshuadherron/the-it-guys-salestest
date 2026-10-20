import { sp } from "../sharepoint-runtime.js";
import { graph } from "../graph.js";
import { priceConfig } from "../quotes.js";
import { quoteDelivery,deliveryStore } from "./delivery-runtime.js";
import { ProposalStore } from "./proposal-store.js";
import { ProposalPreparation } from "./proposals.js";
export const proposalPreparation=new ProposalPreparation({store:new ProposalStore({sp,graph,deliveryStore}),resolver:quoteDelivery.resolver,delivery:quoteDelivery,prices:priceConfig});
