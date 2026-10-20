# BII and Managed IT on one opportunity

The Open SharePoint record form separates planned services from the first operational workflow. Choose Business IT Integration, Managed IT, or BII + Managed IT. For both services, BII first is the default. Josh may choose Managed IT first for timing constraints with a reason of at least 10 characters. Sales users cannot authorize this exception. Both services and the sequence reason remain on the opportunity and in the exported discovery snapshot.

Apply migration 012 before deploying. It adds planned_service_lanes, starting_service_lane and service_sequence_reason to prospects; existing opportunities retain their current lane. The Likely Service sales signal and current service_lane are unchanged in meaning. No pricing, quote approval, contract, signature or activation rules change.

Create Client still sends one valid serviceLane and creates one Clients row at Sales Discovery. The discovery object optionally includes servicePlan metadata (services, scope, startingLane, reason); this metadata records intent, not activation or permission to start both lanes. The quote preparation path honors a saved starting-lane decision rather than silently picking a different lane from the quote.

The current SharePoint contract has one Current Stage. This update does not run two stage engines simultaneously, silently add a live Service Lanes value, or bypass BII Acceptance to switch an already-running BII workflow. The existing BII-to-Managed IT transition remains available at Acceptance. Starting Managed IT first is supported when initially opening the record; adding BII while Managed IT is underway needs a separately verified flow contract. Do not interpret the Both selection as automatic parallel workflow support.

Before using a second-lane quote, ensure the live SharePoint record has that lane enabled through the supported owner workflow. The existing quote-copy resolver continues to refuse a lane that is not enabled. No live SharePoint configuration or flows were changed by this update.
