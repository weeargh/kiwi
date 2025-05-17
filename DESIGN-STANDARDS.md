# Kiwi Equity Platform: Design & Styling Standards

## 1. General Principles

- **Consistency:** All UI elements (cards, tables, filters, buttons, etc.) must follow the same visual language and spacing.
- **Clarity:** Use clear, readable fonts and sufficient contrast for accessibility.
- **Responsiveness:** All layouts must work on desktop and mobile.
- **Auditability:** All design choices (colors, spacing, etc.) must be documented and referenced in code comments.

---

## 2. Typography

- **Font Family:**
  - Primary: `'Plus Jakarta Sans', Arial, Helvetica, sans-serif`
  - Fallback: `'Raleway', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`
- **Font Sizes:**
  - Base: `1rem` (16px)
  - Small: `.875rem` (14px)
  - Extra Small: `.75rem` (12px)
  - Large: `1.25rem` (20px)
- **Font Weights:**
  - Regular: 400
  - Medium: 500
  - Bold: 700

---

## 3. Color Palette

| Name         | Usage                        | HEX       | Bootstrap Class |
|--------------|-----------------------------|-----------|-----------------|
| Primary      | Main actions, highlights    | `#0d6efd` | `.text-primary` |
| Success      | Positive, vested, success   | `#198754` | `.text-success` |
| Info         | Neutral info, stats         | `#0dcaf0` | `.text-info`    |
| Warning      | Warnings, unvested          | `#ffc107` | `.text-warning` |
| Danger       | Errors, returned, negative  | `#dc3545` | `.text-danger`  |
| Muted        | Secondary text, labels      | `#6c757d` | `.text-muted`   |
| Light Gray   | Backgrounds, sidebar        | `#f8f9fa` | `.bg-light`     |
| Border Gray  | Borders, dividers           | `#dee2e6` |                 |
| Table Stripe | Table row background        | `#f2f6fc` |                 |

**Color Usage Examples:**
- Vested: Green (`.text-success`)
- Unvested: Yellow (`.text-warning`)
- Returned: Red (`.text-danger`)
- Kept by Employee: Blue or `.text-primary`
- Card borders: Use `.border-left-*` classes for visual cues

---

## 4. Cards

- **Container:** `.card.shadow-sm`
- **Header:** `.card-header.py-3`
  - Font: Bold, small-caps, `.fw-bold`
  - Background: White or `.bg-light`
- **Body:** `.card-body`
- **Footer:** `.card-footer.bg-light` (optional)
- **Left Border:** Use `.border-left-primary`, `.border-left-success`, etc. for context
- **Hover Effect:**
  - Slight lift: `transform: translateY(-5px);`
  - Shadow: `box-shadow: 0 0.5rem 1rem rgba(0,0,0,0.15)`
- **Spacing:**
  - Padding: `1.5rem` for main cards, `1rem` for compact
  - Margin between cards: `1.5rem` vertical

**Example:**
```html
<div class="card border-left-success shadow-sm mb-4">
  <div class="card-header py-3">
    <h6 class="mb-0 fw-bold text-success">VESTED SHARES</h6>
  </div>
  <div class="card-body">
    <h4 class="mb-0">1,234.567</h4>
    <div class="small text-muted">As of 2024-06-15</div>
  </div>
</div>
```

---

## 5. Tables

- **Container:** `.table.table-striped.table-hover`
- **Header:**
  - Bold, `.fw-600`
  - Background: `.table-light`
- **Rows:**
  - Striped: `background-color: #f2f6fc;`
  - Hover: Slight background highlight
- **Alignment:**
  - Numbers: `.text-end`
  - Text: `.text-start`
- **Pagination:**
  - Use Bootstrap `.pagination` with `.page-link` and `.page-item`
- **Responsiveness:**
  - Wrap in `.table-responsive` for horizontal scroll on mobile

**Clickable Cells:**
- Employee: `<a href="/employees/{id}">Name</a>`
- Grant ID: `<a href="/grants/{id}">{id}</a>`

---

## 6. Filters & Forms

- **Inputs:**
  - Use `.form-control` for text, number, date
  - Use `.form-select` for dropdowns
- **Dropdowns:**
  - Use `<select class="form-select">`
  - For grouped options, use `<optgroup label="...">`
  - For "All" options, use a plain `<option>` outside `<optgroup>`
- **Spacing:**
  - Margin between filters: `.mb-3` or `.me-2`
- **Button:**
  - Use `.btn.btn-primary` for main actions, `.btn-outline-secondary` for secondary
- **Accessibility:**
  - Always use `<label for="...">` and `id` on inputs

**Example:**
```html
<div class="row g-2 mb-3">
  <div class="col-md-3">
    <select id="filterType" class="form-select">
      <option value="">All Types</option>
      <option value="granted">Granted</option>
      <option value="returned_all">Returned (All)</option>
      <optgroup label="Returned (Details)">
        <option value="return_vested">Returned (Vested)</option>
        <option value="return_unvested">Returned (Unvested)</option>
        <option value="return_boughtback">Returned (Boughtback)</option>
      </optgroup>
    </select>
  </div>
  <div class="col-md-3">
    <input type="text" class="form-control" placeholder="Employee Name">
  </div>
  <div class="col-md-3">
    <input type="date" class="form-control">
  </div>
  <div class="col-md-3">
    <button class="btn btn-primary w-100">Filter</button>
  </div>
</div>
```

---

## 7. Sidebar

- **Container:** `#sidebar` or `.sidebar`
- **Width:** `min-width: 220px; max-width: 260px;`
- **Background:** `#f8f9fa`
- **Border:** `1px solid #dee2e6` on the right
- **Sticky:** `position: sticky; top: 0; height: 100vh;`
- **Links:**
  - `.nav-link` for all links
  - `.nav-link.active` for current page (blue, bold)
  - Hover: `.nav-link:hover` (light gray background)
- **Icons:** Use Bootstrap Icons (`<i class="bi ..."></i>`)

---

## 8. Spacing & Layout

- **Container:** `.container` or `.container-fluid`
- **Row/Column:** Use Bootstrap grid (`.row`, `.col-md-6`, etc.)
- **Card Margin:** `.mb-4` for vertical spacing
- **Section Margin:** `.mt-4`, `.mb-4` for top/bottom spacing
- **Sidebar/Main Layout:**
  - Use `.layout` class with `display: flex; min-height: 100vh;`
  - Sidebar: `flex-shrink: 0;`
  - Main: `flex: 1 1 auto;`

---

## 9. Buttons

- **Primary:** `.btn.btn-primary`
- **Secondary:** `.btn.btn-outline-secondary`
- **Danger:** `.btn.btn-danger`
- **Success:** `.btn.btn-success`
- **Small:** `.btn.btn-sm`
- **Full Width:** `.w-100`

---

## 10. Badges & Status

- **Badge:** `.badge` with color class (`.bg-success`, `.bg-danger`, etc.)
- **Status:** Use color and icon for quick recognition

---

## 11. Tooltips & Info

- Use Bootstrap tooltips for info icons:
  `<i class="bi bi-info-circle" data-bs-toggle="tooltip" title="..."></i>`
- Tooltips must be initialized in JS:
  `new bootstrap.Tooltip(...)`

---

## 12. Accessibility

- All interactive elements must be keyboard accessible.
- Use sufficient color contrast (check with [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)).
- Use `aria-label` and `aria-*` attributes where needed.

---

## 13. Code Comments & Auditability

- All custom CSS classes must be documented in `public/css/style.css` with a comment block.
- All color codes and spacing values must be referenced in this doc and in code comments.
- Any deviation from this standard must be justified in a code comment and reviewed.

---

## 14. Example CSS Snippet

```css
/* Card with colored left border */
.border-left-success {
  border-left: 0.25rem solid #198754 !important;
}

/* Sidebar styling */
#sidebar {
  min-height: 100vh;
  background-color: #f8f9fa;
  border-right: 1px solid #dee2e6;
  box-shadow: 0 0.125rem 0.25rem rgba(0,0,0,0.075);
}

/* Table header */
.table th {
  font-weight: 600;
  color: #495057;
}
```

---

## 15. References

- [Bootstrap 5 Documentation](https://getbootstrap.com/docs/5.3/getting-started/introduction/)
- [Bootstrap Icons](https://icons.getbootstrap.com/)
- [WCAG Accessibility Guidelines](https://www.w3.org/WAI/standards-guidelines/wcag/)

---

## Date Format Standard

All dates in the system (UI, API, and database) must use the YYYY-MM-DD format (ISO 8601). This is required for all date fields, including grant dates, vesting dates, and termination dates. Any user input or API payloads must conform to this format to ensure consistency and prevent errors.

---

## Termination and Manual Vesting

When terminating an employee, the system will include all manual vesting events (regardless of creation date or vest_date) in the vested total at termination. This ensures that any manual adjustments, corrections, or accelerated vesting are always counted as vested for the purpose of buyback, keeping, or cancellation. UI and admin workflows should clearly indicate this behavior.

---

## Pagination Design Standard

All tables and list views in Kiwi Equity must use a consistent, user-friendly pagination model:

- Show the first and last page numbers.
- Show a window of 2 pages before and after the current page.
- Use ellipses (`...`) if there are skipped pages between the window and the first/last page.
- Always show Previous/Next buttons, disabled as appropriate.
- Pagination links must preserve all active filters and search parameters.
- This model must be used for all paginated tables, including Employees, Grants, PPS, Audit Logs, and any future lists.

**Example:**

`Previous 1 ... 5 6 [7] 8 9 ... 35 Next`

This ensures a clean, consistent, and user-friendly navigation experience across the platform.

---

## Default Table Sorting

- **Employee List Table:**
  - Default sort: Alphabetical by name (last name, then first name, both ascending)
  - SQL: `ORDER BY last_name ASC, first_name ASC`
- **Grant List Table:**
  - Default sort: Grant date, newest to oldest
  - SQL: `ORDER BY grant_date DESC`

All new tables must specify and document their default sort order in both code and design documentation.

---

**This document should be versioned and reviewed regularly. All team members must follow these standards for any UI/UX work.** 