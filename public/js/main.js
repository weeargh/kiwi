/**
 * Main JavaScript for the RSU/ESOP Platform
 */

document.addEventListener('DOMContentLoaded', function() {
  // Enable Bootstrap tooltips
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function(tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });
  
  // Enable Bootstrap popovers
  const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
  popoverTriggerList.map(function(popoverTriggerEl) {
    return new bootstrap.Popover(popoverTriggerEl);
  });
  
  // Set up CSRF token for AJAX requests
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
  
  if (csrfToken) {
    // Add CSRF token to all AJAX requests
    document.addEventListener('click', function(event) {
      const target = event.target;
      
      // Handle data-method links (for DELETE actions)
      if (target.tagName === 'A' && target.hasAttribute('data-method')) {
        event.preventDefault();
        
        const method = target.getAttribute('data-method').toUpperCase();
        const href = target.getAttribute('href');
        const confirm = target.hasAttribute('data-confirm') ? target.getAttribute('data-confirm') : null;
        
        if (confirm && !window.confirm(confirm)) {
          return;
        }
        
        if (method === 'GET') {
          window.location.href = href;
          return;
        }
        
        // Create a form to submit the request with the correct method
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = href;
        form.style.display = 'none';
        
        const methodInput = document.createElement('input');
        methodInput.type = 'hidden';
        methodInput.name = '_method';
        methodInput.value = method;
        form.appendChild(methodInput);
        
        const csrfInput = document.createElement('input');
        csrfInput.type = 'hidden';
        csrfInput.name = '_csrf';
        csrfInput.value = csrfToken;
        form.appendChild(csrfInput);
        
        document.body.appendChild(form);
        form.submit();
      }
    });
  }
  
  // Format number inputs to always display with 3 decimal places
  document.querySelectorAll('input[type="number"][data-decimal="true"]').forEach(function(input) {
    input.addEventListener('blur', function() {
      if (this.value) {
        // Parse as float and format to 3 decimal places
        const value = parseFloat(this.value);
        if (!isNaN(value)) {
          this.value = value.toFixed(3);
        }
      }
    });
  });
  
  // Handle date inputs
  document.querySelectorAll('input[type="date"]').forEach(function(input) {
    // Set min attribute to today if it has data-min-today attribute
    if (input.hasAttribute('data-min-today')) {
      const today = new Date().toISOString().split('T')[0];
      input.setAttribute('min', today);
    }
  });
  
  // Auto-dismiss alerts after 5 seconds
  setTimeout(function() {
    document.querySelectorAll('.alert.alert-dismissible').forEach(function(alert) {
      // Create and trigger a close button click event
      const closeButton = alert.querySelector('.btn-close');
      if (closeButton) {
        closeButton.click();
      }
    });
  }, 5000);
  
  // Add active class to sidebar based on current path
  const currentPath = window.location.pathname;
  document.querySelectorAll('#sidebar .nav-link').forEach(function(link) {
    const href = link.getAttribute('href');
    // Match exact path or path prefix
    if ((href === currentPath) || 
        (href !== '/' && currentPath.startsWith(href))) {
      link.classList.add('active');
    }
  });
  
  // Initialize form validation
  document.querySelectorAll('form[data-validate="true"]').forEach(function(form) {
    form.addEventListener('submit', function(event) {
      if (!form.checkValidity()) {
        event.preventDefault();
        event.stopPropagation();
      }
      
      form.classList.add('was-validated');
    });
  });

  // Attach event listeners to all terminate buttons (CSP-safe)
  document.body.addEventListener('click', function(event) {
    if (event.target.classList.contains('terminate-employee-btn')) {
      const employeeUid = event.target.getAttribute('data-employee-uid');
      openTerminateEmployeeModal(employeeUid);
    }
  });

  // Returned Shares History Modal logic
  const showReturnedHistoryBtn = document.getElementById('showReturnedHistory');
  if (showReturnedHistoryBtn) {
    showReturnedHistoryBtn.addEventListener('click', function(e) {
      e.preventDefault();
      const tenantUid = showReturnedHistoryBtn.getAttribute('data-tenant-uid');
      const container = document.getElementById('returnedHistoryTableContainer');
      container.innerHTML = '<div class="text-center text-muted">Loading...</div>';
      fetch(`/pools/${tenantUid}/returned-shares-history`)
        .then(res => res.json())
        .then(data => {
          if (!data.success) throw new Error('Failed to fetch history');
          if (!data.data || data.data.length === 0) {
            container.innerHTML = '<div class="alert alert-info">No returned shares history found.</div>';
            return;
          }
          // Build table
          let html = '<div class="table-responsive"><table class="table table-sm table-striped">';
          html += '<thead><tr><th>Date</th><th>Type</th><th class="text-end">Amount</th><th>Effective Date</th><th>By</th><th>Notes</th></tr></thead><tbody>';
          data.data.forEach(ev => {
            html += `<tr>`;
            html += `<td>${ev.created_at ? new Date(ev.created_at).toLocaleString() : ''}</td>`;
            html += `<td>${ev.event_type === 'return_vested' ? 'Vested' : 'Unvested'}</td>`;
            html += `<td class="text-end">${Number(ev.amount).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>`;
            html += `<td>${ev.effective_date || ''}</td>`;
            html += `<td>${ev.created_by || ''}</td>`;
            html += `<td>${ev.notes || ''}</td>`;
            html += `</tr>`;
          });
          html += '</tbody></table></div>';
          container.innerHTML = html;
        })
        .catch(err => {
          container.innerHTML = `<div class="alert alert-danger">Error loading returned shares history.</div>`;
        });
    });
    // Export CSV
    const exportBtn = document.getElementById('exportReturnedHistoryBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function() {
        const tenantUid = showReturnedHistoryBtn.getAttribute('data-tenant-uid');
        fetch(`/pools/${tenantUid}/returned-shares-history`)
          .then(res => res.json())
          .then(data => {
            if (!data.success || !data.data || data.data.length === 0) return;
            const rows = [
              ['Date', 'Type', 'Amount', 'Effective Date', 'By', 'Notes'],
              ...data.data.map(ev => [
                ev.created_at ? new Date(ev.created_at).toLocaleString() : '',
                ev.event_type === 'return_vested' ? 'Vested' : 'Unvested',
                Number(ev.amount).toFixed(3),
                ev.effective_date || '',
                ev.created_by || '',
                ev.notes || ''
              ])
            ];
            const csv = rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'returned_shares_history.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          });
      });
    }
  }
});

function openTerminateEmployeeModal(employeeUid) {
  fetch(`/employees/${employeeUid}/terminate`)
    .then(response => response.text())
    .then(html => {
      document.getElementById('terminateEmployeeModalContent').innerHTML = html;
      var modal = new bootstrap.Modal(document.getElementById('terminateEmployeeModal'));
      modal.show();
    });
} 