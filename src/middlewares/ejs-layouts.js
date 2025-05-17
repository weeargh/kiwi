/**
 * Simple EJS Layout Middleware
 * Provides layout functionality for EJS templates without requiring express-ejs-layouts
 */

const path = require('path');
const fs = require('fs');

/**
 * Express middleware to enable EJS layouts
 * @param {Object} options - Options for layout rendering
 * @returns {Function} - Express middleware function
 */
function expressEjsLayouts(options = {}) {
  const defaultOptions = {
    layoutsDir: 'views',
    defaultLayout: 'layout',
    layoutName: 'layout'
  };
  
  const opts = { ...defaultOptions, ...options };
  
  return function(req, res, next) {
    // Store the original render function
    const originalRender = res.render;
    
    // Override the render function to add layout support
    res.render = function(view, locals = {}, callback) {
      // Set the current route for active menu highlighting
      locals.activeRoute = req.originalUrl;
      
      // IMPORTANT: Ensure csrfToken is always passed from res.locals to the view
      // This ensures the token is available even if the view doesn't explicitly include it
      if (res.locals.csrfToken && locals.csrfToken === undefined) {
        locals.csrfToken = res.locals.csrfToken;
      }
      
      // Similarly ensure other common locals are passed through
      if (res.locals.user && locals.user === undefined) {
        locals.user = res.locals.user;
      }
      
      if (res.locals.currentYear && locals.currentYear === undefined) {
        locals.currentYear = res.locals.currentYear;
      }
      
      // Capture the output of the original view
      originalRender.call(res, view, locals, function(err, output) {
        if (err) {
          if (callback) {
            return callback(err);
          }
          return next(err);
        }
        
        // Skip layout if explicitly disabled
        if (locals.layout === false) {
          if (callback) {
            return callback(null, output);
          }
          return res.send(output);
        }
        
        // Use the layout specified in locals, or the default
        const layoutFile = locals.layout || opts.defaultLayout;
        const layoutPath = path.join(opts.layoutsDir, layoutFile + '.ejs');
        
        // Pass the captured view output to the layout
        // Ensure we merge res.locals into layoutLocals to include any middleware-set values
        const layoutLocals = { 
          ...res.locals,  // Include res.locals first
          ...locals,      // Then override with route-specific locals
          body: output    // Finally add the rendered view body
        };
        
        // Add debug logging if token is missing
        if (!layoutLocals.csrfToken) {
          console.error('CSRF Token missing when rendering layout! View:', view);
          console.error('Available locals:', Object.keys(layoutLocals));
          
          // As a fallback, try to get the token directly
          try {
            if (req.csrfToken) {
              layoutLocals.csrfToken = req.csrfToken();
              console.log('Retrieved CSRF token directly from request');
            }
          } catch (csrfErr) {
            console.error('Failed to get CSRF token from request:', csrfErr.message);
          }
        }
        
        // Render the layout with the view output
        originalRender.call(res, layoutPath, layoutLocals, function(layoutErr, layoutOutput) {
          if (layoutErr) {
            if (callback) {
              return callback(layoutErr);
            }
            return next(layoutErr);
          }
          
          if (callback) {
            return callback(null, layoutOutput);
          }
          
          return res.send(layoutOutput);
        });
      });
    };
    
    next();
  };
}

module.exports = expressEjsLayouts; 