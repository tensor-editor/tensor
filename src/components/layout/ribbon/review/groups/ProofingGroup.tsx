import { RibbonGroup } from "@/components/layout/RibbonGroup";
import { IconButton } from "../../../IconButton";
import { BookA, Info, Languages, SpellCheck } from "lucide-react";
import { useDocumentPropertiesStore } from "@/lib/document/propertiesStore";

export function ProofingGroup() {
  return (
    <RibbonGroup>
      <IconButton label="Spelling & Grammar" icon={<SpellCheck size={16} />} onClick={() => {}} disabled />
      <IconButton label="Dictionary" icon={<BookA size={16} />} onClick={() => {}} disabled />
      <IconButton label="Translate" icon={<Languages size={16} />} onClick={() => { }} disabled />
      <IconButton
        label="Document Properties"
        icon={<Info size={16} />}
        onClick={() => useDocumentPropertiesStore.getState().open()}
      />
    </RibbonGroup>
  );
}
