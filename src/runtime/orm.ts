import { EntitySchema } from 'typeorm';
import { defaultDataSource } from './resolvers/sqldb/database.js';

export let PostSchema: any;
export let CategorySchema: any;

function makeSchemas() {
  /*@Entity()
    class User {
        @PrimaryGeneratedColumn()
        id: number = 0

        @Column()
        firstName: string = ''

        @Column()
        lastName: string = ''

        @Column()
        isActive: boolean = true
    }
    */
  PostSchema = new EntitySchema<any>({
    name: 'Post', // Will use table name `post` as default behaviour.
    columns: {
      id: {
        primary: true,
        type: 'int',
        generated: true,
      },
      title: {
        type: 'varchar',
      },
      text: {
        type: 'text',
      },
    },
    relations: {
      PostCategory: {
        target: 'Category',
        type: 'many-to-many',
        joinTable: true,
        cascade: true,
      },
    },
  });
  CategorySchema = new EntitySchema({
    name: 'Category',
    columns: {
      id: {
        type: Number,
        primary: true,
        generated: true,
      },
      name: {
        type: String,
      },
    },
  });
}

makeSchemas();

export async function CreateTestEntities() {
  if (defaultDataSource) {
    /*const UserSchema = makeUserClass()
        const cols: TableColumnOptions[] = new Array()
        cols.push({name: "id", isPrimary: true, type: "int", isGenerated: true})
        cols.push({name: "firstName", type: "varchar"})
        cols.push({name: "lastName", type: "varchar"})
        cols.push({name: "isActive", type: "boolean", default: true})
        const table: Table = new Table({name: 'user', columns: cols})
        await defaultDataSource.createQueryRunner().createTable(table)*/
    /*const repo = defaultDataSource.getRepository(CategorySchema)
        let cols = new Map<string, any>()
        cols.set('name', 'Music')
        let cat = Object.fromEntries(cols)
        await repo.save(cat)

        const allUsers = await repo.find()
        console.log(allUsers)
        cols = new Map().set('id', 1)
        const firstUser = await repo.findOneBy(Object.fromEntries(cols))
        console.log(firstUser)
        cols = new Map().set('name', 'Music')
        const music = await repo.findOneBy(Object.fromEntries(cols))
        cat = Object.fromEntries(new Map().set('id', 1).set('name', 'Dance'))
        await repo.upsert(cat, ['id'])

        console.log(music)*/

    const category1 = {
      name: 'TypeScript',
    };
    const category2 = {
      name: 'Programming',
    };

    const post = {
      title: 'Control flow based type analysis',
      text: 'TypeScript 2.0 implements a control flow-based type analysis for local variables and parameters.',
      categories: [category1, category2],
    };

    const postRepository = defaultDataSource.getRepository('Post');
    postRepository
      .save(post)
      .then(function (savedPost) {
        console.log('Post has been saved: ', savedPost);
        console.log('Now lets load all posts: ');

        return postRepository.find();
      })
      .then(function (allPosts) {
        console.log('All posts: ', allPosts);
      });
  }
}
