const Sentry = require("@sentry/node");
// const { nodeProfilingIntegration } = require("@sentry/profiling-node"); // Temporarily comment out

// Initialize Sentry
Sentry.init({
  dsn: "https://9e922367cd7e7aa88986eb2ef737a4ab@o4509341353443328.ingest.us.sentry.io/4509341356130304", // Your DSN
  // integrations: [
  //   nodeProfilingIntegration(), // Temporarily comment out
  // ],
  tracesSampleRate: 1.0,
  // profilesSampleRate: 1.0, // profileSessionSampleRate is the correct newer name
  profileSampleRate: 1.0, // Corrected from profileSessionSampleRate based on common usage for profilesSampleRate
  sendDefaultPii: true,
  debug: true, // Keep Sentry debug logging for now
});

// Log to see if Sentry.Handlers is available before exporting
console.log("--- DEBUG instrument.js (no profiling integration) ---");
console.log("Sentry.Handlers type:", typeof Sentry.Handlers);
console.log("Sentry.Handlers keys:", Sentry.Handlers ? Object.keys(Sentry.Handlers) : "Sentry.Handlers is undefined/null");
console.log("--- END DEBUG instrument.js ---");

// Now, when this module is required, it will have executed Sentry.init().
// The Sentry instance that app.js gets from require('../instrument.js') 
// will be the one directly from Node's cache, which should now be initialized
// and have Handlers.

// Export the Sentry object that was just initialized and should now be in Node's module cache.
// This is the standard way Sentry expects to be used when init is in a separate file.
module.exports = require('@sentry/node'); 