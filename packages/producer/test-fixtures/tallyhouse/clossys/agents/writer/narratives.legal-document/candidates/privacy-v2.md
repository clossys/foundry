---
clossys:
  schema: clossys.candidate/1
  id: writer/narratives.legal-document/privacy-v2.md
  agent: writer
  kind: candidate
  status: submitted
  slot: writer/narratives.legal-document
  record: privacy
  briefSha256: c482b6181e211552e92da3997b3a0522168ad552a61d01ddb9053d213d0dca6c
  createdBy: { actor: agent, agent: writer, skill: packages/writer/actions/writer.candidates/skill.md, skillSha256: 1fd773f9039d79a0d6fda2cd1498a7aa84a28fd52b9fa0ff7090d0e4f3c6cb87, model: claude-opus-5-5, tier: high }
  createdAt: 2026-11-17T15:20:00Z
  refs: [{ to: director/capability.team.structure, key: Decides, rel: input }]
  source: { kind: derived, ref: [writer/narratives.legal-document/package:privacy-v1.md] }
  rationale:
    - { purpose: keep, why: Seven years covers the tax-record period the owner set., sources: [{ to: facts, key: retention.years, rel: cites }] }
    - { purpose: contact, why: Names the privacy officer role from governance., sources: [{ to: director/capability.team.structure, key: Decides, rel: cites }] }
---

## en

# Privacy policy
Effective {fact:effective.date}.

### collect
We collect {fact:data.collected}, only what we need to keep your books.

### use
We use your information to do your bookkeeping, send your monthly reports and bill you. We do not sell it.

### share
We share it only with the services that run our work: {fact:processors}.

### keep
We keep your records for {fact:retention.years} years after our work ends, then delete them.

### rights
You can ask to see, correct or delete your information at any time.

### contact
Write to our privacy officer at {fact:contact.privacy}.

### change
If this policy changes, we will email you before the new version takes effect.

## fr

# Politique de confidentialité
En vigueur le {fact:effective.date}.

### collect
Nous recueillons {fact:data.collected}, seulement ce qu'il faut pour tenir vos livres.

### use
Nous utilisons vos renseignements pour tenir vos livres, envoyer vos rapports mensuels et vous facturer. Nous ne les vendons pas.

### share
Nous les communiquons seulement aux services qui font tourner notre travail : {fact:processors}.

### keep
Nous conservons vos dossiers {fact:retention.years} ans après la fin de notre mandat, puis nous les supprimons.

### rights
Vous pouvez demander à consulter, corriger ou supprimer vos renseignements en tout temps.

### contact
Écrivez à notre responsable de la protection des renseignements à {fact:contact.privacy}.

### change
Si cette politique change, nous vous écrirons avant l'entrée en vigueur de la nouvelle version.
