module Family

entity Family {
    id UUID @id @default(uuid()),
    name String @unique
}

entity Member {
    email Email @id,
    name String
}

relationship FamilyMember contains (Family, Member) @one_many
                             
                                          