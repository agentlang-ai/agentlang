model Family

entity Family {
    id UUID (@id, @auto),
    name String @unique
}

entity Member {
    email Email @id,
    name String,
    family Family @contains=members, // an alternative way to add contains from child. 
    spouse Member (@between, @unique), // self 1-1 between relationship
    children Member @between, // self N-N between relationship
    parents Member @between // self N-N between relationship
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
                             
                                          