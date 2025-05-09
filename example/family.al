module Family

entity Family {
    id UUID (@id, @auto),
    name String @unique
}

entity Member {
    email Email @id,
    name String
}

// one-many
relationship FamilyMember contains (Family, Member) {
    Family.members Member[],
    Member.family Ref(Family.id as familyId)
}

// one-many, self-relation
relationship ParentChild contains (Member, Member) {
    Member.parent Ref(Member.id as parentId)
    Member.children Member[]
}

// ParentChild could also be a M-M self-relationship
relationship ParentsChildren between (Member, Member) {
    Member.parents Member[],
    Member.children Member[]
}

// Modelling hierarchy using only refs (or pointers).
// A member can have zero or more successors and predecessors.
relationship FamilyHistory between (Member, Member) {
    Member.successor Ref(Member.id as successorId) @unique,
    Member.predecessor Ref(successorId)
}

workflow CreateMember {
    {Family {id? CreateMember.familyId
             members+ {Member {email CreateMember.email,
                               name CreateMember.name,
                               spouse {Member {id? CreateMember.spouseId}},
                               parents [{Member {id? CreateMember.fatherId}},
                                        {Member {id? CreateMember.motherId}}]}}}}
}

workflow LookupFamilyFromMember {
    {Member {id? LookupFamilyFromMember.memberId}} as member;
    member.family // return the parent Family
}
                             
                                          