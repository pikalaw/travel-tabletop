declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

/** The release version, from package.json. */
export const APP_VERSION: string = __APP_VERSION__;
/** The first 7 characters of the commit that built this copy, or `dev`. */
export const BUILD_ID: string = __BUILD_ID__;
/** Bumped only when host and guest messages change shape. */
export const PROTOCOL_VERSION = 3; // 2: detachAll; 3: setLead, attachments added farthest from the lead
