---
description: Entry point for Magento 2 code generation — routes the request to the matching generator skill (defaults to module-create for a whole new module).
argument-hint: "[<type>] [<Vendor>_<Module>] [--flags]"
---
Match the request to the generator skill below and invoke THAT skill directly, forwarding these arguments verbatim: $ARGUMENTS

- a whole new module/extension → `m2-module-create` (the default)
- a plugin / observer / preference onto existing code → `m2-extension-point`
- admin Stores → Configuration settings → `m2-system-config`
- a `bin/magento` console command or cron job → `m2-cli-command`
- an async message-queue surface → `m2-message-queue`
- a product/customer/category EAV attribute → `m2-eav-attribute`
- a GraphQL query/mutation/type → `m2-graphql`
- a REST / Web-API surface for an existing entity → `m2-webapi`
- a theme, RequireJS/Knockout/Alpine component, or email template → `m2-frontend`
- an admin UI-component edit form → `m2-admin-form`
- an admin UI-component grid/listing → `m2-admin-listing`
- a CMS widget (etc/widget.xml + block + template, insertable from Content → Widgets) → `m2-widget`

If the request is multi-surface or its scope is unclear, use `m2-feature` instead.
If no specialist matches, default to the `m2-module-create` skill.
