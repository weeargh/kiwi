const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

Sentry.init({
  dsn: "https://9e922367cd7e7aa88986eb2ef737a4ab@o4509341353443328.ingest.us.sentry.io/4509341356130304",
  integrations: [
    // Ensure you have @sentry/integrations installed if you use specific ones here
    // For now, let's simplify to just a basic integration that comes with @sentry/node
    // new Sentry.Integrations.Http({ tracing: true }), // Example
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  // profilesSampleRate: 1.0, // profileSessionSampleRate is the correct newer name
  profileSampleRate: 1.0, // Corrected from profileSessionSampleRate based on common usage for profilesSampleRate
  sendDefaultPii: true,
  debug: true, // Enable Sentry debug logging
});

// Log to see if Sentry.Handlers is available before exporting
console.log("--- DEBUG instrument.js ---");
console.log("Sentry.Handlers type:", typeof Sentry.Handlers);
console.log("Sentry.Handlers keys:", Sentry.Handlers ? Object.keys(Sentry.Handlers) : "Sentry.Handlers is undefined/null");
console.log("--- END DEBUG instrument.js ---");

module.exports = Sentry; 