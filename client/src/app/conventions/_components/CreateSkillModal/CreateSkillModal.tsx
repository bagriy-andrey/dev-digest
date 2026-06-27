"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { useCreateSkillFromConventions } from "@/lib/hooks/conventions";
import { buildSkillBody } from "./helpers";
import { s } from "./styles";

interface CreateSkillModalProps {
  repoId: string;
  candidates: ConventionCandidate[];
  onClose: () => void;
  onCreated: (skillId: string) => void;
}

export function CreateSkillModal({ repoId, candidates, onClose, onCreated }: CreateSkillModalProps) {
  const t = useTranslations("conventions");
  const createSkill = useCreateSkillFromConventions();

  const [name, setName] = React.useState("Repo Conventions");
  const [description, setDescription] = React.useState("");

  const previewBody = buildSkillBody(name, candidates);

  const submit = async () => {
    const result = await createSkill.mutateAsync({
      repoId,
      name: name.trim() || "Repo Conventions",
      description,
      candidateIds: candidates.map((c) => c.id),
    });
    onCreated(result.skillId);
  };

  return (
    <Modal
      width={680}
      title={t("skill.modalTitle")}
      subtitle={t("skill.modalSubtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("skill.cancelButton")}
          </Button>
          <Button
            kind="primary"
            icon="Plus"
            onClick={submit}
            disabled={createSkill.isPending}
          >
            {createSkill.isPending ? t("skill.creating") : t("skill.confirmButton")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("skill.nameLabel")}>
          <TextInput
            value={name}
            onChange={setName}
            placeholder={t("skill.namePlaceholder")}
          />
        </FormField>
        <FormField label={t("skill.descriptionLabel")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("skill.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("skill.previewLabel")}>
          <Textarea value={previewBody} onChange={() => {}} rows={10} mono />
        </FormField>
      </div>
    </Modal>
  );
}
