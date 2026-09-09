import { NormalizedRunEventProvider } from "../../events/NormalizedRunEvents";
import { isStreamingDecoderCompatError } from "./HermesProtocol";

/** Hermes can emit a decoder failure before its status endpoint becomes terminal. */
export class HermesRunEventProvider extends NormalizedRunEventProvider {
  constructor() {
    super({ shouldReconcileEmptyFailure: isStreamingDecoderCompatError });
  }
}

export const hermesRunEventProvider = Object.freeze(new HermesRunEventProvider());
