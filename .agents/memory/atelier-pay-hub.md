---
name: Atelier pay hub invariants
description: Deliberate design constraints of the Me-lens pay & benefits hub (Task-#54 era)
---
- Pay-document bytes are stored base64 IN-ROW (atelier_pay_documents.file_data, 10MB cap) on purpose: no object storage configured, and in-row keeps every download behind the ACL-gated routes. Don't "fix" without migrating ACLs too.
- The HR approve handler is the ONLY code path that writes iban/swift from a bank-change request; self routes never touch roster bank columns. Audit payloads must carry masked IBANs only.
- Multipart upload + binary downloads are bespoke raw-fetch routes (not in openapi.yaml); JSON pay routes go through orval codegen.
- Category rules: contractor forbids payslip/insurance, employee forbids remittance; contractor /me/pay has bank=null & insurance=null by design.
