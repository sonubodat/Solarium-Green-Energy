# Request for Information

## Solarium Energy QR Referral Platform

**Document purpose:** Confirm the business decisions, operational inputs, and deployment information required to complete the Solarium Energy referral platform.

**Prepared for:** Solarium Energy

**Project domain:** `https://solariumenergy.in`

**Current document status:** For client review and confirmation

## 1. Executive Summary

We are developing a secure web platform that connects physical QR codes distributed to vendors with customer referrals and leads.

The platform will allow Solarium Energy to:

- Maintain a controlled inventory of physical QR codes.
- Assign QR codes to vendors and preserve assignment history.
- Onboard vendors through self-registration and Sales-assisted verification.
- Capture customer enquiries from public QR links.
- Attribute each scan and lead to the correct vendor at the time it occurred.
- Detect repeat customer referrals according to the approved business rule.
- Allow Admin users to review operations and manually update payout status.
- Give Vendors access only to their own approved information.

The first release is intentionally focused. It is a referral attribution and lead tracking system, not a full CRM, commission engine, accounting system, or automated payout platform.

## 2. What We Are Building

The solution has four experiences:

### Public customer experience

Customers scan a URL such as:

```text
https://solariumenergy.in/v/VEN-0001
```

The platform checks the QR status, identifies the currently assigned vendor, records the scan, and displays a simple enquiry form. Customers do not log in and cannot change the QR, vendor, or referral attribution.

### Vendor portal

Vendors can securely log in and view:

- Their own business profile.
- Their own referral leads.
- Their own payout status.
- Their own account and password settings.

Vendor data is always restricted to the authenticated Vendor account.

### Sales portal

Sales users can manage the operational onboarding process:

- View registrations assigned to or owned by them.
- Contact and onboard vendors.
- Check QR availability.
- Assign an unassigned QR to an authorized vendor.

Sales users cannot access Admin controls, unrestricted lead data, payout information, or active QR reassignment.

### Admin portal

Admins can manage the complete operational system:

- Vendors and vendor registrations.
- QR inventory and assignment history.
- Scans and leads.
- Manual payout statuses.
- Sales and staff users.
- Audit records.
- Vendor deactivation and password reset operations.

## 3. How the System Will Work

### Vendor and QR onboarding

```text
Vendor self-registers
	|
Sales reviews the registration
	|
Sales contacts and onboards the vendor
	|
Sales selects or confirms an unassigned QR
	|
QR is assigned and activated
	|
Vendor can use the physical QR for referrals
```

### Customer referral flow

```text
Customer scans the physical QR
	|
Backend validates the QR
	|
Backend finds the current active assignment
	|
Backend records the scan and vendor attribution
	|
Customer submits an enquiry
	|
Backend normalizes the mobile number
	|
Backend applies the duplicate attribution rule
	|
Lead is stored with historical attribution
```

### QR reassignment

If a QR is moved from one vendor to another, the previous assignment is closed and a new assignment is created. Existing scans, leads, and payout records remain attached to the original vendor. This protects historical business records and prevents future reassignment from changing past attribution.

## 4. Proposed Technical Approach

The solution will use a simple monolithic full-stack architecture:

```text
React frontend
	|
Node.js / Express REST API
	|
Prisma database access
	|
PostgreSQL hosted by Supabase
```

The frontend and backend remain separate directories and can be deployed independently:

- Frontend: Vercel or AWS Amplify.
- Backend: Render or an equivalent Node.js hosting service.
- Database: Supabase PostgreSQL.

This approach avoids unnecessary microservices while providing a practical path to approximately 50,000 vendors and millions of scans, leads, and audit records. Database indexes, bounded pagination, connection pooling, and historical attribution are part of the design.

## 5. Security and Data Protection

The implementation will include:

- Server-managed HTTP-only authentication sessions.
- Separate Admin, Sales, and Vendor authorization rules.
- Server-side ownership checks for every protected resource.
- Hashed passwords; plaintext passwords are never stored.
- Short-lived, single-use password reset records.
- Server-side HMAC identity for customer deduplication.
- Protected customer contact data.
- Database uniqueness and integrity constraints.
- Rate limiting on public QR and lead endpoints.
- Audit records for sensitive administrative actions.
- Environment variables for database and application secrets.
- No privileged secrets in frontend code.

The frontend will not be treated as a security boundary. Every important permission will be enforced by the backend.

## 6. Current Product Decisions

The current plan intentionally uses the following decisions:

| Area | Current decision |
| --- | --- |
| Authentication | Username or mobile plus password for staff and Vendors |
| Public access | No customer account or customer login |
| QR identity | QR identifies a physical asset, not a vendor |
| Attribution | Vendor and assignment are captured when the scan occurs |
| Duplicate identity | Normalized Indian mobile number protected by server-side HMAC |
| Payouts | Manual `UNPAID` and `PAID` status only |
| Payout payment data | `paid_at`, `paid_by`, and manual `paid_reference` when marked paid |
| QR reassignment | Admin-only for active QRs; history is preserved |
| Sales access | Limited to assigned or owned onboarding work |
| Vendor access | Restricted to the authenticated Vendor |
| Scale target | Approximately 50,000 vendors and high-volume referral records |

## 7. Scope Excluded From the First Release

The following items are not included in the current implementation scope:

- Commission calculation or approval workflows.
- Commission progress dashboards, completion meters, or KPI scorecards.
- Automated Razorpay, UPI, or other payout integrations.
- PAN or TDS collection and calculation.
- Customer login, customer dashboard, or customer progress tracking.
- Customer checkboxes, completion toggles, or score-like controls.
- Automated vendor OTP recovery.
- Email-based password recovery.
- Full CRM, orders, inventory, delivery, marketing automation, or messaging.
- Separate microservices for QR, authentication, payouts, or analytics.

The application may retain manual payout status records, but it will not calculate a commission amount in the current release.

## 8. Work Completed So Far

The following foundation and backend modules are currently implemented or prepared:

- Separate `frontend/` and `backend/` application boundaries.
- React portal preview for Public, Vendor, Sales, and Admin areas.
- Express REST API and centralized error handling.
- Prisma 7 configuration with PostgreSQL adapter support.
- Supabase database connection and applied migrations.
- Admin, Sales, and Vendor authentication and authorization.
- Password change and reset flows.
- Vendor self-registration and Sales onboarding.
- QR inventory, assignment, and Admin reassignment.
- Immutable scan attribution.
- Public QR resolution and rate limiting.
- Lead capture, mobile normalization, and duplicate lead status.
- Vendor lead and manual payout views.
- Admin operational lists and write operations.
- Staff user management and audit logging.
- Development seed data for repeatable API testing.
- Local frontend/backend configuration and deployment environment templates.

The next delivery focus is security hardening, authorization testing, frontend integration with the live APIs, and production-readiness validation.

## 9. Client Information Required

Please confirm or provide the following information.

### Business rules

1. What is the final definition of a duplicate customer referral?
2. Is the duplicate rule global, campaign-based, vendor-based, or limited to a defined attribution period?
3. Which lead statuses should Admin users be allowed to use?
4. What conditions make a lead eligible for manual payout marking?
5. Who is authorized to mark a payout as paid?
6. Should Vendor mobile numbers be unique across all Vendors?
7. Should a Vendor registration be rejected, archived, or editable after rejection?

### Vendor onboarding

1. Which Vendor fields are mandatory beyond business name, owner name, mobile number, and login identifier?
2. Who is allowed to see the Vendor mobile number during onboarding?
3. Should Sales users see only their own registrations, or all unassigned registrations?
4. What is the approved process when a Vendor forgets a password?
5. Should Vendor accounts require password change on first login after onboarding or reset?

### QR operations

1. What QR code prefix and numbering format should be used: `VEN-0001`, `V-0001`, or another format?
2. What quantity should be generated in the initial QR batch?
3. Are printable QR sheets and downloadable QR images required in the first release?
4. What should customers see when a QR is unassigned, inactive, or retired?
5. Who may approve or request QR reassignment?

### Customer and privacy requirements

1. Which customer fields should be collected: name, mobile, email, location, or additional fields?
2. What consent or privacy wording must appear on the public enquiry form?
3. How long should customer and lead records be retained?
4. Should customer email and location be visible to Vendors, or only to Admin users?
5. Are there legal, regulatory, or internal data-handling requirements we must include?

### Branding and user experience

1. Please provide the approved Solarium Energy logo, colors, fonts, and brand guidelines.
2. Please provide the preferred wording for public QR and enquiry pages.
3. Please confirm whether the portals should use English only or support additional languages.
4. Please provide any existing screen designs or examples that should be followed.
5. Please confirm the desired confirmation message after a customer submits an enquiry.

### Deployment and operations

1. Confirm the final frontend hosting provider and project name.
2. Confirm the final backend hosting provider and project name.
3. Confirm the Supabase project and production database ownership.
4. Provide the production frontend origin for backend CORS configuration.
5. Provide the final domain and DNS access process.
6. Confirm who will manage production secrets and environment variables.
7. Confirm the required backup, monitoring, and incident-response expectations.

## 10. Recommended Client Decisions Before Production

Before production release, we recommend confirming:

- Final domain and brand assets.
- Final Vendor and lead fields.
- Duplicate referral policy.
- Data retention and privacy wording.
- Payout eligibility and approval responsibility.
- Initial QR quantity and printable format.
- Admin and Sales user responsibilities.
- Production hosting and access ownership.
- Acceptance test users and sample data.

## 11. Proposed Delivery Method

Work will continue in small, verifiable modules:

1. Confirm business rules and client answers.
2. Complete security and authorization tests.
3. Connect portal screens to live backend APIs.
4. Add loading, empty, validation, and error states.
5. Validate QR assignment, reassignment, lead attribution, duplicates, and Vendor isolation.
6. Validate production environment variables, CORS, cookies, database connectivity, and migrations.
7. Complete client acceptance testing using agreed scenarios.
8. Deploy the approved frontend and backend configuration.

Each module will be checked against the implementation plan, API contract, data model, and acceptance criteria in the project documentation.

## 12. Acceptance Scenarios

The client acceptance review should include at least these scenarios:

1. An unassigned QR cannot create a valid vendor referral.
2. An assigned QR displays the correct vendor context.
3. A submitted lead retains the vendor and QR assignment active at scan time.
4. A repeat customer is handled according to the approved duplicate rule.
5. Reassigning a QR does not change historical leads.
6. A Vendor cannot access another Vendor's records.
7. A Sales user cannot access Admin or payout functions.
8. Only an Admin can mark a payout as paid.
9. Deactivating a Vendor preserves historical records.
10. Public QR and lead endpoints reject excessive or invalid requests safely.

## 13. Confirmation

Please review this RFI and provide answers to the questions in Section 9. The answers will be used to finalize the remaining UI details, validation rules, acceptance tests, and production configuration.

### Client comments

```text
Client name:
Reviewer:
Date:

Business rule decisions:

Branding and UI decisions:

Deployment and access decisions:

Additional requirements:
```

## Related Project Documents

- [Implementation plan](plan.md)
- [Technical architecture](architecture.md)
- [Data model](data-model.md)
- [API contract](api.md)
- [Requirements](requirements.md)
- [Development progress](progress.md)
- [Development tasks](tasks.md)
