# Design rubric

Rank both candidates on a 1 to 5 scale for each criterion.

1. Preserve owner isolation, revocation, immutable revisions, durable idempotency, CAS updates and publication.
2. Give direct HTTP consumers and CLI users a complete independently usable authenticated workflow.
3. Concentrate domain and authentication decisions behind small package boundaries.
4. Keep current MCP and panel contracts and deployments compatible.
5. Minimize implementation and operational complexity while providing real cross-transport proof.

Required alternatives are shared-core transport adapters and MCP consuming REST. Compare real usage, module map, public signatures, authentication, deployment, uncertainty and conflict behavior. No production deployment is authorized.
