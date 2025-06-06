import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from "typeorm"

@Entity()
export class User extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    firstName: string

    @Column()
    lastName: string

    @Column()
    isActive: boolean
}

export async function CreateTestEntities() {
    const user = new User()
    user.firstName = "Timber"
    user.lastName = "Saw"
    await user.save()

    const allUsers = await User.find()
    const firstUser = await User.findOneBy({
        id: 1,
    })
    const timber = await User.findOneBy({
        firstName: "Timber",
        lastName: "Saw"
    })

    
}