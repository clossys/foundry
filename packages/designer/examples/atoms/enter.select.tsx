const setFavoriteFruit = (_id: string | number | null): void => {};

import { Select } from "@clossys/designer/atoms";

function FavoriteFruitField() {
  return (
    <Select
      label="Favorite fruit"
      description="Used for the weekly snack order."
      placeholder="Pick one"
      options={[
        { id: "apple", label: "Apple" },
        { id: "banana", label: "Banana" },
        { id: "cherry", label: "Cherry", isDisabled: true },
      ]}
      onChange={(id) => setFavoriteFruit(id)}
    />
  );
}

export default FavoriteFruitField;
