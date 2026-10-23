const user: { imageUrl: string; fullName: string } = { imageUrl: "/avatar.png", fullName: "Example User" };

import { Avatar } from "@clossys/designer/atoms";

function UserAvatar() {
  return <Avatar src={user.imageUrl} alt={user.fullName} size="md" />;
}

export default UserAvatar;
